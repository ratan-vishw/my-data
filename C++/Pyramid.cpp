#include<iostream>
using namespace std;
int main() {
  cout<<"Enter Number: ";
  int n;
  cin>>n;
  for (int i = 1; n>=i; i++){
    //spaces
    for (int k = n; k-i>=0; k--){
      cout<<" ";
    }
    
    //nums 1
    for (int j = 1; i>=j; j++){
      cout<<j;
    }
    //num 2
    for (int r = i; r-1>=1; r--){
      cout<<r-1;
    }
    cout<<endl;
  }

  return 0;
}