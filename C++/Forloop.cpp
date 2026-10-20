#include<iostream>
using namespace std;
int main() {
  cout<<"Enter Number: ";
  int n;
  cin>>n;
  
  //for(initialization; condition; update)
  for (int i = 1; n>=i; i++) {
    cout<<i<<" ";
  }
  cout<<endl;
  return 0;
}