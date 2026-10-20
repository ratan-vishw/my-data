#include<iostream>
using namespace std;
int main() {
  cout<<"Enter Number: ";
  int n;
  cin>>n;
  for(int i = 1; n>=i; i++){
    for(int j = 1; i>=j; j++){
      cout<<i; 
    }
    cout<<endl;
  }
  return 0;
}