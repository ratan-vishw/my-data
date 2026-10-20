#include<iostream>
using namespace std;
int main(){
  cout<<"Enter Number: ";
  int n;
  cin>>n;
  //column
  for (int i = 1; n>=i; i++){
    //spaces
    for(int k = 0; i>=k; k++){
    cout<<" ";  
    }
    //number(row)
    for (int j = 0; n-i>=j; j++){
      cout<<i;
    }
    cout<<endl;
  }
  return 0;
}